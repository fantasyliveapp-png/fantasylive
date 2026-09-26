'use server';

import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

/**
 * DENUNCIAS desde perfiles, publicaciones y chats.
 *
 * Usa la misma tabla que las denuncias de llamadas, con `context` para saber
 * que se denuncio. Las revisa el equipo en /admin/reports.
 */

export interface SafetyActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const REASONS = [
  'HARASSMENT',
  'SPAM',
  'IMPERSONATION',
  'UNDERAGE',
  'NON_CONSENSUAL',
  'OTHER',
] as const;

const reportSchema = z.object({
  reportedUserId: z.string().min(1),
  reason: z.enum(REASONS),
  details: z.string().trim().max(1000).optional(),
  context: z
    .string()
    .regex(/^(profile|(post|chat|conversation):[\w-]+)$/, 'Contexto no valido.')
    .default('profile'),
});

export async function reportUserAction(input: {
  reportedUserId: string;
  reason: (typeof REASONS)[number];
  details?: string;
  context?: string;
}): Promise<SafetyActionResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no validos.' };
    }
    const data = parsed.data;
    if (data.reportedUserId === me.id) return { ok: false, error: 'No puedes denunciarte a ti.' };

    const target = await prisma.user.findUnique({
      where: { id: data.reportedUserId },
      select: { id: true },
    });
    if (!target) return { ok: false, error: 'Esta cuenta no existe.' };

    // Una denuncia abierta por persona y cosa denunciada: sin duplicados.
    const open = await prisma.report.findFirst({
      where: {
        reporterId: me.id,
        reportedId: target.id,
        context: data.context,
        status: 'OPEN',
      },
      select: { id: true },
    });
    if (open) {
      return { ok: true, message: 'Ya denunciaste esto. Nuestro equipo lo esta revisando.' };
    }

    await prisma.report.create({
      data: {
        reporterId: me.id,
        reportedId: target.id,
        reason: data.reason,
        details: data.details || null,
        context: data.context,
      },
    });

    return {
      ok: true,
      message: 'Gracias. Nuestro equipo revisara la denuncia; la otra persona no sabra quien la hizo.',
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return { ok: false, error: 'Debes iniciar sesion.' };
    }
    return { ok: false, error: 'No se pudo enviar la denuncia.' };
  }
}
