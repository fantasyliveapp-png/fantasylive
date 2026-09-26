'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { SUPPORT_CATEGORIES } from '@/lib/support';

/** SOPORTE (lado del usuario): abrir una consulta y contestar en ella. */

export interface SupportResult {
  ok: boolean;
  error?: string;
  message?: string;
  ticketId?: string;
}

const MAX_OPEN = 5;

const createSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES.map((c) => c.value) as [string, ...string[]]),
  subject: z.string().trim().min(4, 'Resume tu consulta en unas palabras.').max(120),
  body: z.string().trim().min(10, 'Cuentanos un poco mas (minimo 10 letras).').max(4000),
});

export async function createSupportTicketAction(input: {
  category: string;
  subject: string;
  body: string;
}): Promise<SupportResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no validos.' };
    }
    const open = await prisma.supportTicket.count({
      where: { userId: user.id, status: { not: 'CLOSED' } },
    });
    if (open >= MAX_OPEN) {
      return {
        ok: false,
        error: 'Ya tienes varias consultas abiertas. Escribe en una de ellas.',
      };
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        category: parsed.data.category,
        subject: parsed.data.subject,
        messages: { create: { authorId: user.id, body: parsed.data.body } },
      },
      select: { id: true },
    });

    revalidatePath('/soporte');
    return { ok: true, ticketId: ticket.id, message: 'Consulta enviada. Te responderemos pronto.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function replySupportTicketAction(input: {
  ticketId: string;
  body: string;
}): Promise<SupportResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const body = input.body.trim().slice(0, 4000);
    if (!body) return { ok: false, error: 'Escribe tu mensaje.' };

    const ticket = await prisma.supportTicket.findFirst({
      where: { id: input.ticketId, userId: user.id },
      select: { id: true },
    });
    if (!ticket) return { ok: false, error: 'Consulta no encontrada.' };

    await prisma.$transaction([
      prisma.supportMessage.create({ data: { ticketId: ticket.id, authorId: user.id, body } }),
      // Si estaba cerrada o respondida, vuelve a la bandeja del equipo.
      prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'OPEN' } }),
    ]);

    revalidatePath(`/soporte/${ticket.id}`);
    return { ok: true, message: 'Mensaje enviado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    return error.message;
  }
  return 'Error inesperado.';
}
