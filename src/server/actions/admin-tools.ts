'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

/**
 * HERRAMIENTAS DEL ADMIN: destacar creadoras, avisos a todos y responder
 * consultas de soporte. Todo deja rastro en el registro de actividad.
 */

export interface ToolResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function requireAdminUser() {
  const user = await getAuthedUserOrThrow();
  if (user.role !== 'ADMIN') throw new Error('FORBIDDEN');
  return user;
}

// ---------------------------------------------------------------------------
// DESTACAR CREADORAS
// ---------------------------------------------------------------------------

/** Destaca a una creadora `days` dias (0 = quitar). */
export async function featureCreatorAction(input: {
  modelId: string;
  days: number;
}): Promise<ToolResult> {
  try {
    const admin = await requireAdminUser();
    const days = Math.max(0, Math.min(90, Math.round(input.days)));
    const model = await prisma.modelProfile.findUnique({
      where: { id: input.modelId },
      select: { id: true, stageName: true, kycStatus: true, featuredUntil: true },
    });
    if (!model) return { ok: false, error: 'Creadora no encontrada.' };
    if (days > 0 && model.kycStatus !== 'APPROVED') {
      return { ok: false, error: 'Solo se puede destacar a creadoras verificadas.' };
    }

    // Si ya estaba destacada, los dias se suman a los que le quedaban.
    const from = Math.max(Date.now(), model.featuredUntil?.getTime() ?? 0);
    const featuredUntil = days > 0 ? new Date(from + days * 86_400_000) : null;
    await prisma.modelProfile.update({ where: { id: model.id }, data: { featuredUntil } });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: days > 0 ? 'CREATOR_FEATURED' : 'CREATOR_UNFEATURED',
        entityType: 'ModelProfile',
        entityId: model.id,
        metadata: { days },
      },
    });

    revalidatePath('/admin/destacadas');
    return {
      ok: true,
      message: days > 0 ? `${model.stageName} destacada ${days} dias.` : 'Ya no esta destacada.',
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// AVISOS A TODOS
// ---------------------------------------------------------------------------

export type Audience = 'all' | 'fans' | 'creators' | 'founders';

function audienceWhere(audience: Audience): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { status: 'ACTIVE', role: { not: 'ADMIN' } };
  switch (audience) {
    case 'fans':
      return { ...base, modelProfile: { is: null } };
    case 'creators':
      return { ...base, modelProfile: { isNot: null } };
    case 'founders':
      return { ...base, modelProfile: { is: { founderNumber: { not: null } } } };
    default:
      return base;
  }
}

/** Cuantas personas recibirian un aviso (para mostrarlo antes de enviar). */
export async function countAudienceAction(audience: Audience): Promise<number> {
  await requireAdminUser();
  return prisma.user.count({ where: audienceWhere(audience) });
}

const announcementSchema = z.object({
  audience: z.enum(['all', 'fans', 'creators', 'founders']),
  title: z.string().trim().min(3, 'Pon un titulo.').max(120),
  body: z.string().trim().max(1000).optional(),
  link: z
    .string()
    .trim()
    .regex(/^\/[^\s]*$/, 'El enlace debe ser una ruta de la web, p. ej. /feed')
    .optional()
    .or(z.literal('')),
});

export async function sendAnnouncementAction(input: {
  audience: Audience;
  title: string;
  body?: string;
  link?: string;
}): Promise<ToolResult> {
  try {
    const admin = await requireAdminUser();
    const parsed = announcementSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no validos.' };
    }
    const d = parsed.data;

    const users = await prisma.user.findMany({
      where: audienceWhere(d.audience),
      select: { id: true },
    });
    if (users.length === 0) return { ok: false, error: 'No hay nadie en ese grupo.' };

    // Por lotes: miles de filas de golpe pueden tumbar la consulta.
    for (let i = 0; i < users.length; i += 1000) {
      await prisma.notification.createMany({
        data: users.slice(i, i + 1000).map((u) => ({
          userId: u.id,
          type: 'ANNOUNCEMENT' as const,
          title: d.title,
          body: d.body || null,
          link: d.link || null,
        })),
      });
    }

    const a = await prisma.announcement.create({
      data: {
        audience: d.audience,
        title: d.title,
        body: d.body || null,
        link: d.link || null,
        sentCount: users.length,
        createdById: admin.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'ANNOUNCEMENT_SENT',
        entityType: 'Announcement',
        entityId: a.id,
        metadata: { audience: d.audience, sentCount: users.length },
      },
    });

    revalidatePath('/admin/avisos');
    return { ok: true, message: `Aviso enviado a ${users.length} personas.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// SOPORTE (lado del equipo)
// ---------------------------------------------------------------------------

export async function replySupportAction(input: {
  ticketId: string;
  body: string;
  close?: boolean;
}): Promise<ToolResult> {
  try {
    const admin = await requireAdminUser();
    const body = input.body.trim().slice(0, 4000);
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: input.ticketId },
      select: { id: true, userId: true, subject: true },
    });
    if (!ticket) return { ok: false, error: 'Consulta no encontrada.' };
    if (!body && !input.close) return { ok: false, error: 'Escribe una respuesta.' };

    await prisma.$transaction(async (tx) => {
      if (body) {
        await tx.supportMessage.create({
          data: { ticketId: ticket.id, authorId: admin.id, fromStaff: true, body },
        });
      }
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { status: input.close ? 'CLOSED' : 'ANSWERED' },
      });
      if (body) {
        await createNotification(tx, {
          userId: ticket.userId,
          type: 'SUPPORT_REPLY',
          title: 'Soporte te ha respondido',
          body: ticket.subject,
          link: `/soporte/${ticket.id}`,
        });
      }
    });

    revalidatePath('/admin/soporte');
    revalidatePath(`/admin/soporte/${ticket.id}`);
    return { ok: true, message: input.close ? 'Consulta cerrada.' : 'Respuesta enviada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function setSupportStatusAction(input: {
  ticketId: string;
  status: 'OPEN' | 'CLOSED';
}): Promise<ToolResult> {
  try {
    await requireAdminUser();
    await prisma.supportTicket.update({
      where: { id: input.ticketId },
      data: { status: input.status },
    });
    revalidatePath('/admin/soporte');
    revalidatePath(`/admin/soporte/${input.ticketId}`);
    return { ok: true, message: input.status === 'CLOSED' ? 'Consulta cerrada.' : 'Consulta reabierta.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'FORBIDDEN') return 'Solo para administradores.';
    return error.message;
  }
  return 'Error inesperado.';
}
