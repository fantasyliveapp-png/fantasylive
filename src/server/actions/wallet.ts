'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { startTokenPurchase } from '@/lib/payments';
import {
  InsufficientTokensError,
  applyLedgerEntry,
  getWalletSummary,
  transferWithCommission,
} from '@/lib/tokens';

export interface WalletActionResult {
  ok: boolean;
  error?: string;
  redirectUrl?: string | null;
  balance?: number;
  message?: string;
}

/** Inicia la compra de un paquete de tokens. */
export async function purchaseTokensAction(
  packageId: string,
): Promise<WalletActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const result = await startTokenPurchase({
      userId: user.id,
      packageId,
      userEmail: user.email,
    });

    if (result.credited) {
      revalidatePath('/wallet');
      return {
        ok: true,
        balance: result.newBalance,
        message: `Se han acreditado ${result.tokens} tokens (modo prueba).`,
      };
    }

    return { ok: true, redirectUrl: result.url };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Desbloquea un paquete de contenido pagando con tokens. */
export async function unlockContentAction(
  packageId: string,
): Promise<WalletActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const pkg = await prisma.contentPackage.findUnique({
      where: { id: packageId },
      include: { model: { select: { id: true, userId: true, stageName: true, slug: true } } },
    });

    if (!pkg || !pkg.isPublished) {
      return { ok: false, error: 'Este contenido no esta disponible.' };
    }
    if (pkg.model.userId === user.id) {
      return { ok: false, error: 'Este contenido ya es tuyo.' };
    }

    const already = await prisma.contentUnlock.findUnique({
      where: { userId_packageId: { userId: user.id, packageId } },
    });
    if (already) {
      return { ok: true, message: 'Ya tenias este contenido desbloqueado.' };
    }

    if (pkg.priceTokens === 0 || pkg.isPublic) {
      await prisma.contentUnlock.create({
        data: { userId: user.id, packageId, tokensSpent: 0 },
      });
      revalidatePath(`/models/${pkg.model.slug}`);
      return { ok: true, message: 'Contenido desbloqueado.' };
    }

    const balance = await prisma.$transaction(async (tx) => {
      const { debit } = await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: pkg.model.userId,
        tokens: pkg.priceTokens,
        debitType: 'CONTENT_UNLOCK',
        creditType: 'CONTENT_EARNING',
        description: `Contenido: ${pkg.title}`,
        contentPackageId: pkg.id,
      });

      await tx.contentUnlock.create({
        data: {
          userId: user.id,
          packageId,
          tokensSpent: pkg.priceTokens,
        },
      });

      await tx.contentPackage.update({
        where: { id: packageId },
        data: {
          purchaseCount: { increment: 1 },
          tokensEarned: { increment: pkg.priceTokens },
        },
      });

      return debit.balanceAfter;
    });

    revalidatePath(`/models/${pkg.model.slug}`);
    revalidatePath('/wallet');

    return {
      ok: true,
      balance,
      message: `Contenido desbloqueado por ${pkg.priceTokens} tokens.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

const giftSchema = z.object({
  receiverId: z.string().min(1),
  tokens: z.number().int().min(1).max(100000),
  sessionId: z.string().optional(),
  emoji: z.string().max(8).optional(),
  message: z.string().max(200).optional(),
});

/** Envia una propina (tip) durante o fuera de una llamada. */
export async function sendGiftAction(input: {
  receiverId: string;
  tokens: number;
  sessionId?: string;
  emoji?: string;
  message?: string;
}): Promise<WalletActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = giftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Datos de regalo invalidos.' };

    const { receiverId, tokens, sessionId, emoji, message } = parsed.data;
    if (receiverId === user.id) {
      return { ok: false, error: 'No puedes enviarte regalos a ti mismo.' };
    }

    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, name: true },
    });
    if (!receiver) return { ok: false, error: 'Destinatario no encontrado.' };

    const balance = await prisma.$transaction(async (tx) => {
      const gift = await tx.gift.create({
        data: {
          senderId: user.id,
          receiverId,
          sessionId: sessionId ?? null,
          tokens,
          emoji: emoji ?? null,
          message: message ?? null,
        },
        select: { id: true },
      });

      const { debit } = await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: receiverId,
        tokens,
        debitType: 'TIP',
        creditType: 'TIP_EARNING',
        description: `Regalo para ${receiver.name ?? 'modelo'}`,
        callSessionId: sessionId,
        giftId: gift.id,
      });

      return debit.balanceAfter;
    });

    return {
      ok: true,
      balance,
      message: `Has enviado ${tokens} tokens.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function getWalletAction() {
  const user = await getAuthedUserOrThrow();
  return getWalletSummary(user.id);
}

/** Ajuste manual de saldo (solo ADMIN). */
export async function adminAdjustBalanceAction(input: {
  userId: string;
  tokens: number;
  reason: string;
}): Promise<WalletActionResult> {
  try {
    const admin = await getAuthedUserOrThrow();
    if (admin.role !== 'ADMIN') return { ok: false, error: 'No autorizado.' };

    const amount = Math.abs(Math.round(input.tokens));
    if (amount === 0) return { ok: false, error: 'Importe invalido.' };

    const { balanceAfter } = await prisma.$transaction((tx) =>
      applyLedgerEntry(tx, {
        userId: input.userId,
        type: input.tokens > 0 ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        tokens: amount,
        description: input.reason || 'Ajuste manual de administracion',
        metadata: { adminId: admin.id },
      }),
    );

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: input.tokens > 0 ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        entityType: 'Wallet',
        entityId: input.userId,
        metadata: { tokens: input.tokens, reason: input.reason },
      },
    });

    revalidatePath('/admin/users');
    return { ok: true, balance: balanceAfter, message: 'Saldo ajustado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof InsufficientTokensError) return error.message;
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'ACCOUNT_BANNED') return 'Cuenta suspendida.';
    if (error.message === 'PACKAGE_NOT_AVAILABLE')
      return 'El paquete seleccionado no esta disponible.';
    if (error.message === 'STRIPE_NOT_CONFIGURED')
      return 'La pasarela de pago no esta configurada. Usa PAYMENT_PROVIDER=mock en local.';
    return error.message;
  }
  return 'Error inesperado.';
}
