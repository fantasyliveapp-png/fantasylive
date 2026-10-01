'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { applyLedgerEntry, splitPayoutFee, tokensToPayoutCents, withdrawableTokens } from '@/lib/tokens';
import { formatMoney } from '@/lib/utils';

/**
 * RECLUTADORES (solo admin).
 *
 * Alta con las condiciones negociadas, cambios, pausar y registrar pagos.
 * Los pagos se hacen fuera de la web (transferencia, etc.) y aqui se anotan:
 * se descuenta de su saldo retirable y queda en el historial.
 */

export interface RecruiterActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Tope para que la plataforma siempre gane algo (su % - 5% embajadora - este tope). */
const MAX_PERCENT = 10;

async function requireAdminUser() {
  const user = await getAuthedUserOrThrow();
  if (user.role !== 'ADMIN') throw new Error('FORBIDDEN');
  return user;
}

const termsSchema = z.object({
  commissionPercent: z.number().int().min(1).max(MAX_PERCENT),
  /** null = para siempre */
  months: z.number().int().min(1).max(60).nullable(),
  /** null = sin tope */
  maxCreators: z.number().int().min(1).max(10000).nullable(),
  notes: z.string().trim().max(2000).optional(),
});

const createSchema = termsSchema.extend({
  account: z.string().trim().min(1, 'Indica el @usuario o el email.'),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,30}$/, 'Codigo: 3-31 letras, numeros o guiones.')
    .optional(),
});

export async function createRecruiterAction(input: {
  account: string;
  code?: string;
  commissionPercent: number;
  months: number | null;
  maxCreators: number | null;
  notes?: string;
}): Promise<RecruiterActionResult> {
  try {
    const admin = await requireAdminUser();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no validos.' };
    }
    const d = parsed.data;
    const handle = d.account.replace(/^@/, '').toLowerCase();

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: handle }, { email: handle }] },
      select: { id: true, username: true, status: true, recruiterAccount: { select: { id: true } } },
    });
    if (!user) {
      return {
        ok: false,
        error: 'No existe esa cuenta. Pidele que se registre primero y te pase su @usuario.',
      };
    }
    if (user.status !== 'ACTIVE') return { ok: false, error: 'Esa cuenta no esta activa.' };
    if (user.recruiterAccount) return { ok: false, error: 'Esa cuenta ya es reclutador.' };

    const code = d.code ?? (user.username ?? handle).replace(/[^a-z0-9-]/g, '-').slice(0, 31);
    if (await prisma.recruiter.findUnique({ where: { code }, select: { id: true } })) {
      return { ok: false, error: `El codigo "${code}" ya esta en uso: elige otro.` };
    }

    const recruiter = await prisma.recruiter.create({
      data: {
        userId: user.id,
        code,
        commissionPercent: d.commissionPercent,
        months: d.months,
        maxCreators: d.maxCreators,
        notes: d.notes || null,
      },
      select: { id: true },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'RECRUITER_CREATED',
        entityType: 'Recruiter',
        entityId: recruiter.id,
        metadata: { code, commissionPercent: d.commissionPercent, months: d.months, maxCreators: d.maxCreators },
      },
    });

    revalidatePath('/admin/reclutadores');
    return { ok: true, message: `Reclutador creado. Su enlace: /reclutar/${code}` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function updateRecruiterAction(input: {
  id: string;
  active?: boolean;
  commissionPercent?: number;
  months?: number | null;
  maxCreators?: number | null;
  notes?: string;
}): Promise<RecruiterActionResult> {
  try {
    const admin = await requireAdminUser();
    const current = await prisma.recruiter.findUnique({ where: { id: input.id } });
    if (!current) return { ok: false, error: 'Reclutador no encontrado.' };

    const parsed = termsSchema.safeParse({
      commissionPercent: input.commissionPercent ?? current.commissionPercent,
      months: input.months !== undefined ? input.months : current.months,
      maxCreators: input.maxCreators !== undefined ? input.maxCreators : current.maxCreators,
      notes: input.notes ?? current.notes ?? undefined,
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no validos.' };
    }

    await prisma.recruiter.update({
      where: { id: current.id },
      data: {
        ...parsed.data,
        notes: parsed.data.notes || null,
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'RECRUITER_UPDATED',
        entityType: 'Recruiter',
        entityId: current.id,
        metadata: { ...parsed.data, active: input.active ?? current.active },
      },
    });

    revalidatePath('/admin/reclutadores');
    return { ok: true, message: 'Condiciones guardadas.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Anota que se le ha pagado TODO su saldo retirable (el pago se hace fuera:
 * transferencia, PayPal...). Se descuenta de su monedero con su historial.
 */
export async function payRecruiterAction(input: {
  id: string;
  note?: string;
}): Promise<RecruiterActionResult> {
  try {
    const admin = await requireAdminUser();
    const recruiter = await prisma.recruiter.findUnique({
      where: { id: input.id },
      select: { id: true, userId: true, code: true, user: { select: { wallet: true } } },
    });
    if (!recruiter) return { ok: false, error: 'Reclutador no encontrado.' };

    const wallet = recruiter.user.wallet;
    const tokens = wallet ? withdrawableTokens(wallet) : 0;
    if (tokens <= 0) return { ok: false, error: 'No tiene nada pendiente de pago.' };
    // Mismo minimo que los retiros de las creadoras ($25).
    if (tokens < config.economy.minPayoutTokens) {
      return {
        ok: false,
        error: `Aun no llega al minimo de pago (${formatMoney(tokensToPayoutCents(config.economy.minPayoutTokens))}).`,
      };
    }
    // Igual que las creadoras: se descuenta la comision de retiro (10%).
    const { feeTokens, netTokens } = splitPayoutFee(tokens);
    const cents = tokensToPayoutCents(netTokens);

    await prisma.$transaction(async (tx) => {
      await applyLedgerEntry(tx, {
        userId: recruiter.userId,
        type: 'PAYOUT',
        tokens,
        amountCents: cents,
        currency: 'USD',
        platformFeeTokens: feeTokens,
        description: `Pago a reclutador (${formatMoney(cents)}, comision de retiro ${formatMoney(tokensToPayoutCents(feeTokens))})${input.note ? `: ${input.note.slice(0, 200)}` : ''}`,
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: 'RECRUITER_PAID',
          entityType: 'Recruiter',
          entityId: recruiter.id,
          metadata: { tokens, feeTokens, netTokens, cents, note: input.note ?? null },
        },
      });
    });

    revalidatePath('/admin/reclutadores');
    return {
      ok: true,
      message: `Paga ${formatMoney(cents)} (su saldo menos el ${config.economy.payoutFeePercent}% de retiro). Anotado.`,
    };
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
