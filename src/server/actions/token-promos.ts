'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { PROMO_LIMITS } from '@/lib/token-promos';

/** PROMOCIONES DE TOKENS (solo admin). */

export interface PromoActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const schema = z
  .object({
    title: z.string().trim().min(2, 'Ponle un nombre a la promocion.').max(40),
    percentOff: z
      .number()
      .int()
      .min(PROMO_LIMITS.min, `El descuento minimo es ${PROMO_LIMITS.min}%.`)
      .max(PROMO_LIMITS.max, `El descuento maximo es ${PROMO_LIMITS.max}%.`),
    /** ISO; vacio = desde ya */
    startsAt: z.string().optional(),
    endsAt: z.string().min(1, 'Indica hasta cuando dura.'),
    /** Avisar a todos los fans cuando empiece. */
    notify: z.boolean().optional(),
  })
  .refine((d) => !Number.isNaN(Date.parse(d.endsAt)), { message: 'Fecha de fin no valida.' });

export async function createTokenPromoAction(input: {
  title: string;
  percentOff: number;
  startsAt?: string;
  endsAt: string;
  notify?: boolean;
}): Promise<PromoActionResult> {
  try {
    const admin = await requireAdminUser();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no validos.' };
    const d = parsed.data;
    const startsAt = d.startsAt ? new Date(d.startsAt) : new Date();
    const endsAt = new Date(d.endsAt);
    if (Number.isNaN(startsAt.getTime())) return { ok: false, error: 'Fecha de inicio no valida.' };
    if (endsAt <= startsAt) return { ok: false, error: 'Tiene que terminar despues de empezar.' };
    if (endsAt <= new Date()) return { ok: false, error: 'La fecha de fin ya ha pasado.' };

    const promo = await prisma.tokenPromo.create({
      data: { title: d.title, percentOff: d.percentOff, startsAt, endsAt, createdById: admin.id },
      select: { id: true },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'TOKEN_PROMO_CREATED',
        entityType: 'TokenPromo',
        entityId: promo.id,
        metadata: { title: d.title, percentOff: d.percentOff, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      },
    });

    // Aviso a los fans. Se fecha al inicio: la campana solo enseña avisos
    // con fecha pasada, asi que una promo programada avisa cuando empieza.
    let notified = 0;
    if (d.notify) {
      const fans = await prisma.user.findMany({
        where: { status: 'ACTIVE', role: { not: 'ADMIN' }, modelProfile: { is: null } },
        select: { id: true },
      });
      const minutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
      const lasts = minutes <= 120 ? `solo ${minutes} minutos` : `hasta el ${endsAt.toLocaleDateString('es')}`;
      for (let i = 0; i < fans.length; i += 1000) {
        await prisma.notification.createMany({
          data: fans.slice(i, i + 1000).map((u) => ({
            userId: u.id,
            type: 'ANNOUNCEMENT' as const,
            title: `${d.title}: tokens hasta −${d.percentOff}%`,
            body: `Aprovecha, ${lasts}.`,
            link: '/wallet',
            createdAt: startsAt,
          })),
        });
      }
      notified = fans.length;
    }

    revalidateAll();
    return {
      ok: true,
      message: `Promocion creada: hasta −${d.percentOff}% en tokens.${notified ? ` Avisaremos a ${notified} fans.` : ''}`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function setTokenPromoActiveAction(id: string, active: boolean): Promise<PromoActionResult> {
  try {
    const admin = await requireAdminUser();
    await prisma.tokenPromo.update({ where: { id }, data: { active } });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: active ? 'TOKEN_PROMO_RESUMED' : 'TOKEN_PROMO_PAUSED', entityType: 'TokenPromo', entityId: id },
    });
    revalidateAll();
    return { ok: true, message: active ? 'Promocion activada.' : 'Promocion pausada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function deleteTokenPromoAction(id: string): Promise<PromoActionResult> {
  try {
    const admin = await requireAdminUser();
    await prisma.tokenPromo.delete({ where: { id } });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'TOKEN_PROMO_DELETED', entityType: 'TokenPromo', entityId: id },
    });
    revalidateAll();
    return { ok: true, message: 'Promocion borrada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function revalidateAll() {
  revalidatePath('/admin/promociones');
  revalidatePath('/wallet');
  revalidatePath('/');
}

async function requireAdminUser() {
  const user = await getAuthedUserOrThrow();
  if (user.role !== 'ADMIN') throw new Error('FORBIDDEN');
  return user;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'FORBIDDEN') return 'Solo para administradores.';
    return error.message;
  }
  return 'Error inesperado.';
}
