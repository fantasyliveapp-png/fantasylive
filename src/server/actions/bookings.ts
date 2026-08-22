'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { applyLedgerEntry, InsufficientTokensError } from '@/lib/tokens';
import { applySubscriberDiscount, getActiveSubscription } from '@/lib/subscriptions';
import { randomRoomName } from '@/lib/utils';

export interface BookingActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  bookingId?: string;
  sessionId?: string;
}

const createSchema = z.object({
  modelSlug: z.string().min(1),
  startsAt: z.string().min(1),
  durationMinutes: z.number().int().min(5).max(240),
  note: z.string().max(300).optional(),
});

/**
 * Crea una reserva y RETIENE los tokens del usuario (BOOKING_HOLD).
 * El importe se libera a la modelo al completar la videollamada.
 */
export async function createBookingAction(input: {
  modelSlug: string;
  startsAt: string;
  durationMinutes: number;
  note?: string;
}): Promise<BookingActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Datos de reserva invalidos.' };

    const startsAt = new Date(parsed.data.startsAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt < new Date()) {
      return { ok: false, error: 'Elige una fecha y hora futuras.' };
    }

    const model = await prisma.modelProfile.findUnique({
      where: { slug: parsed.data.modelSlug },
      select: {
        id: true,
        userId: true,
        stageName: true,
        privateRatePerMinute: true,
        minPrivateMinutes: true,
        acceptsBookings: true,
        kycStatus: true,
      },
    });

    if (!model) return { ok: false, error: 'Modelo no encontrada.' };
    if (model.userId === user.id) {
      return { ok: false, error: 'No puedes reservar contigo misma/o.' };
    }
    if (!model.acceptsBookings || model.kycStatus !== 'APPROVED') {
      return { ok: false, error: 'Esta modelo no acepta reservas ahora mismo.' };
    }
    if (parsed.data.durationMinutes < model.minPrivateMinutes) {
      return {
        ok: false,
        error: `La duracion minima con esta modelo es de ${model.minPrivateMinutes} minutos.`,
      };
    }

    // Evita solapamiento con otra reserva confirmada
    const endsAt = new Date(
      startsAt.getTime() + parsed.data.durationMinutes * 60000,
    );
    const overlapping = await prisma.booking.findFirst({
      where: {
        modelId: model.id,
        status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED', 'IN_PROGRESS'] },
        startsAt: { lt: endsAt },
      },
      select: { id: true, startsAt: true, durationMinutes: true },
    });

    if (overlapping) {
      const overlapEnd = new Date(
        overlapping.startsAt.getTime() + overlapping.durationMinutes * 60000,
      );
      if (overlapEnd > startsAt) {
        return { ok: false, error: 'Ese horario ya esta ocupado. Elige otro.' };
      }
    }

    const subscription = await getActiveSubscription(user.id, model.id);
    const ratePerMinute = subscription
      ? applySubscriberDiscount(
          model.privateRatePerMinute,
          subscription.discountPercent,
        )
      : model.privateRatePerMinute;
    const totalTokens = ratePerMinute * parsed.data.durationMinutes;

    const booking = await prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          userId: user.id,
          modelId: model.id,
          startsAt,
          durationMinutes: parsed.data.durationMinutes,
          ratePerMinute,
          totalTokens,
          userNote: parsed.data.note ?? null,
          status: 'PENDING_CONFIRMATION',
        },
      });

      await applyLedgerEntry(tx, {
        userId: user.id,
        type: 'BOOKING_HOLD',
        tokens: totalTokens,
        description: `Reserva con ${model.stageName} (${parsed.data.durationMinutes} min)`,
        bookingId: created.id,
      });

      return created;
    });

    revalidatePath('/bookings');
    revalidatePath(`/models/${parsed.data.modelSlug}`);

    return {
      ok: true,
      bookingId: booking.id,
      message: `Reserva creada. Se han retenido ${totalTokens} tokens hasta la sesion.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** La modelo confirma la reserva. */
export async function confirmBookingAction(
  bookingId: string,
): Promise<BookingActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { model: { select: { userId: true } } },
    });

    if (!booking) return { ok: false, error: 'Reserva no encontrada.' };
    if (booking.model.userId !== user.id && user.role !== 'ADMIN') {
      return { ok: false, error: 'No autorizado.' };
    }
    if (booking.status !== 'PENDING_CONFIRMATION') {
      return { ok: false, error: 'Esta reserva ya no se puede confirmar.' };
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });

    revalidatePath('/dashboard/model/bookings');
    revalidatePath('/bookings');
    return { ok: true, message: 'Reserva confirmada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Cancela una reserva. Devuelve los tokens retenidos salvo cancelacion
 * del usuario con menos de 2 horas de antelacion (penalizacion del 50%).
 */
export async function cancelBookingAction(
  bookingId: string,
  reason?: string,
): Promise<BookingActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { model: { select: { userId: true, stageName: true } } },
    });

    if (!booking) return { ok: false, error: 'Reserva no encontrada.' };

    const isOwner = booking.userId === user.id;
    const isModel = booking.model.userId === user.id;
    if (!isOwner && !isModel && user.role !== 'ADMIN') {
      return { ok: false, error: 'No autorizado.' };
    }
    if (!['PENDING_CONFIRMATION', 'CONFIRMED'].includes(booking.status)) {
      return { ok: false, error: 'Esta reserva ya no se puede cancelar.' };
    }

    const hoursUntil =
      (booking.startsAt.getTime() - Date.now()) / (1000 * 60 * 60);

    // La modelo cancela => reembolso integro. El usuario con <2h => 50%.
    const refundRatio = isModel || user.role === 'ADMIN' ? 1 : hoursUntil < 2 ? 0.5 : 1;
    const refund = Math.floor(booking.totalTokens * refundRatio);

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: isModel ? 'CANCELLED_BY_MODEL' : 'CANCELLED_BY_USER',
          cancelledAt: new Date(),
          refundedTokens: refund,
          modelNote: isModel ? (reason ?? null) : booking.modelNote,
          userNote: isOwner ? (reason ?? booking.userNote) : booking.userNote,
        },
      });

      if (refund > 0) {
        await applyLedgerEntry(tx, {
          userId: booking.userId,
          type: 'BOOKING_REFUND',
          tokens: refund,
          description: `Devolucion reserva con ${booking.model.stageName}`,
          bookingId: booking.id,
        });
      }
    });

    revalidatePath('/bookings');
    revalidatePath('/dashboard/model/bookings');

    return {
      ok: true,
      message:
        refund === booking.totalTokens
          ? `Reserva cancelada. Se han devuelto ${refund} tokens.`
          : `Reserva cancelada con penalizacion. Se han devuelto ${refund} de ${booking.totalTokens} tokens.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Abre la sala de la videollamada reservada.
 * Solo disponible en la ventana [inicio-10min, fin+15min].
 */
export async function startBookingCallAction(
  bookingId: string,
): Promise<BookingActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        model: { select: { userId: true } },
        callSession: { select: { id: true } },
      },
    });

    if (!booking) return { ok: false, error: 'Reserva no encontrada.' };

    const isOwner = booking.userId === user.id;
    const isModel = booking.model.userId === user.id;
    if (!isOwner && !isModel) return { ok: false, error: 'No autorizado.' };

    if (booking.callSession) {
      return { ok: true, sessionId: booking.callSession.id };
    }

    if (booking.status !== 'CONFIRMED') {
      return { ok: false, error: 'La reserva debe estar confirmada.' };
    }

    const now = Date.now();
    const opensAt = booking.startsAt.getTime() - 10 * 60 * 1000;
    const closesAt =
      booking.startsAt.getTime() + (booking.durationMinutes + 15) * 60 * 1000;

    if (now < opensAt) {
      return {
        ok: false,
        error: 'La sala se abre 10 minutos antes de la hora reservada.',
      };
    }
    if (now > closesAt) {
      return { ok: false, error: 'La ventana de esta reserva ya ha pasado.' };
    }

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.callSession.create({
        data: {
          type: 'PRIVATE',
          status: 'PENDING',
          callerId: booking.userId,
          calleeId: booking.model.userId,
          roomName: randomRoomName('book'),
          // Ya se retuvo el importe al reservar: no se cobra por minuto
          ratePerMinute: 0,
          bookingId: booking.id,
        },
        select: { id: true },
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'IN_PROGRESS' },
      });

      return created;
    });

    return { ok: true, sessionId: session.id };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Libera los tokens retenidos a la modelo al completar la reserva.
 * Lo dispara la modelo o el admin tras la sesion.
 */
export async function settleBookingAction(
  bookingId: string,
): Promise<BookingActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { model: { select: { userId: true, id: true, stageName: true } } },
    });

    if (!booking) return { ok: false, error: 'Reserva no encontrada.' };
    if (booking.model.userId !== user.id && user.role !== 'ADMIN') {
      return { ok: false, error: 'No autorizado.' };
    }
    if (!['IN_PROGRESS', 'CONFIRMED'].includes(booking.status)) {
      return { ok: false, error: 'Esta reserva no se puede liquidar.' };
    }

    const commission = Math.round(
      (booking.totalTokens *
        Number(process.env.PLATFORM_COMMISSION_PERCENT ?? 30)) /
        100,
    );
    const modelTokens = booking.totalTokens - commission;

    await prisma.$transaction(async (tx) => {
      await applyLedgerEntry(tx, {
        userId: booking.model.userId,
        type: 'CALL_EARNING',
        tokens: modelTokens,
        description: `Reserva completada (${booking.durationMinutes} min)`,
        bookingId: booking.id,
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      await tx.modelProfile.update({
        where: { id: booking.model.id },
        data: {
          totalCalls: { increment: 1 },
          totalMinutes: { increment: booking.durationMinutes },
          totalTokensEarned: { increment: modelTokens },
        },
      });
    });

    revalidatePath('/dashboard/model/bookings');
    return { ok: true, message: `Liquidado: ${modelTokens} tokens acreditados.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof InsufficientTokensError) return error.message;
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    return error.message;
  }
  return 'Error inesperado.';
}
