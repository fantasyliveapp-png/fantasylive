'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { DEAL_LIMITS } from '@/lib/deals';
import { prisma } from '@/lib/prisma';

/**
 * TRATOS CON CREADORAS (solo admin): poner, cambiar o quitar los % negociados.
 */

export interface DealActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const dealSchema = z
  .object({
    modelId: z.string().min(1),
    /** null = el estandar */
    platformPercent: z
      .number()
      .int()
      .min(DEAL_LIMITS.platformMin, `La plataforma debe quedarse al menos un ${DEAL_LIMITS.platformMin}%.`)
      .max(DEAL_LIMITS.platformMax)
      .nullable(),
    ambassadorPercent: z
      .number()
      .int()
      .min(DEAL_LIMITS.ambassadorMin)
      .max(DEAL_LIMITS.ambassadorMax, `El % de embajadora no puede pasar del ${DEAL_LIMITS.ambassadorMax}%.`)
      .nullable(),
    /** "2026-12-31" o null = sin fecha de fin */
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.platformPercent != null || d.ambassadorPercent != null, {
    message: 'El trato tiene que cambiar al menos un %.',
  });

export async function setCreatorDealAction(input: {
  modelId: string;
  platformPercent: number | null;
  ambassadorPercent: number | null;
  until: string | null;
  notes?: string;
}): Promise<DealActionResult> {
  try {
    const admin = await requireAdminUser();
    const parsed = dealSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no validos.' };
    }
    const d = parsed.data;
    // Vale hasta el final de ese dia (UTC).
    const until = d.until ? new Date(`${d.until}T23:59:59.999Z`) : null;
    if (until && until <= new Date()) return { ok: false, error: 'La fecha de fin ya ha pasado.' };

    const profile = await prisma.modelProfile.update({
      where: { id: d.modelId },
      data: {
        dealPlatformPercent: d.platformPercent,
        dealAmbassadorPercent: d.ambassadorPercent,
        dealUntil: until,
        dealNotes: d.notes || null,
        dealUpdatedAt: new Date(),
      },
      select: { id: true, userId: true, stageName: true },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'CREATOR_DEAL_SET',
        entityType: 'ModelProfile',
        entityId: profile.id,
        metadata: {
          platformPercent: d.platformPercent,
          ambassadorPercent: d.ambassadorPercent,
          until: until?.toISOString() ?? null,
        },
      },
    });

    revalidatePath(`/admin/users/${profile.userId}`);
    revalidatePath('/admin/tratos');
    return { ok: true, message: `Trato guardado para ${profile.stageName}.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function clearCreatorDealAction(modelId: string): Promise<DealActionResult> {
  try {
    const admin = await requireAdminUser();
    const profile = await prisma.modelProfile.update({
      where: { id: modelId },
      data: {
        dealPlatformPercent: null,
        dealAmbassadorPercent: null,
        dealUntil: null,
        dealUpdatedAt: new Date(),
      },
      select: { id: true, userId: true, stageName: true },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'CREATOR_DEAL_CLEARED',
        entityType: 'ModelProfile',
        entityId: profile.id,
      },
    });
    revalidatePath(`/admin/users/${profile.userId}`);
    revalidatePath('/admin/tratos');
    return { ok: true, message: `${profile.stageName} vuelve a las condiciones estandar.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
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
